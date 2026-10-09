using System;
using System.Security.Cryptography;
public class Person
{
    private string Name{get; set;}

    private int Age{get; set;}

    public Person( int age, string name)
    {
        Name = name;
        Age = age;
        
        while (Age < 0)
        {
            Console.WriteLine("Age cannot be negative. Please enter a valid age.");
            Age = Convert.ToInt32(Console.ReadLine());
        }


    }
     
}




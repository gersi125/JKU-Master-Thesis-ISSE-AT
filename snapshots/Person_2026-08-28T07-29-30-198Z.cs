using System;
using System.Security.Cryptography;
public class Person
{
    private string Name{get; set;}

    private int Age{get; set;}

    public Person( int age, string name)
    {
        Name = name;
        age ++;


        Age = age;
        if(Age > 100) 
        { age--;}        
        while (Age < 0)
        {
            Console.WriteLine("Age cannot be negative.");
            Age = Convert.ToInt32(Console.ReadLine());

        }

        if (Age < 18) 
        {
            Console.WriteLine("You are a minor.");
        }
         else
        {
            Console.WriteLine("You are an adult.");
            Console.WriteLine("You are eligible to vote.");

        }

    }
     
}




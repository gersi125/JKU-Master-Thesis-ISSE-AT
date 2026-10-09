using System;
using System.Security.Cryptography;
public class Person
{
    private string Name{get; set;}

    private int Age{get; set;}

    public Person( int age, string name)
    {
        Name = name;

        Age  = age;

        if (Age < 0)
        {
            throw new ArgumentException("Age cannot be negative");
        }


    }
     
}




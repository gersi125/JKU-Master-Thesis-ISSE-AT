using System;
using System.Security.Cryptography;
public class Person
{
    private string Name { get; set; }
    private int Age { get; set; }

    private string Gender { get; set; }
    

    public Person(string name, int age)
    {
        Name = name;
        Age = age;

        Name="John";    
        Age = 25;

    }
     
}



